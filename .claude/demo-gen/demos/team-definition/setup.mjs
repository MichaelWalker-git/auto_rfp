// One-time data setup for the team-definition demo.
// Runs the real pipelines on dev so the recording starts from a rich state:
//   1. CV import  → employee pool populated
//   2. solution-plan init → grilling + synthesis → READY (team auto-recommended)
//   3. TEAM_QUALIFICATIONS document generation (timed, leaves a READY doc)
import { readFileSync } from 'node:fs';

const BASE = 'https://dev0c9xj07.execute-api.us-east-1.amazonaws.com/Dev';
const ORG = '9c0a5757-e2da-4e71-9490-01c558f7ffc3';
const PROJECT = 'ca6ef9e2-507d-4fe6-8f3d-6ee41264fe92';
const OPP = 'dd0d0bd1-7512-410a-babf-bf8f43aff7c6';

const state = JSON.parse(readFileSync(new URL('./auth-state.json', import.meta.url), 'utf8'));
const idToken = state.origins[0].localStorage.find((e) => e.name.endsWith('.idToken')).value;
const H = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

const get = async (path) => (await fetch(`${BASE}${path}`, { headers: H })).json();
const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const step = process.argv[2] ?? 'all';

if (step === 'import' || step === 'all') {
  const emp = await get(`/employee/list?orgId=${ORG}`);
  log('employees before import:', emp.count);
  const t = await post('/employee/import/trigger', { orgId: ORG });
  log('import trigger:', t.status, JSON.stringify(t.body).slice(0, 120));
  for (;;) {
    await sleep(5000);
    const { run } = await get(`/employee/import/latest?orgId=${ORG}`);
    log('import status:', run?.status, `scanned=${run?.documentsScanned} cvs=${run?.cvsDetected} created=${run?.employeesCreated} updated=${run?.employeesUpdated}`);
    if (run && run.status !== 'RUNNING') break;
  }
  const after = await get(`/employee/list?orgId=${ORG}`);
  log('employees after import:', after.count);
}

if (step === 'plan' || step === 'all') {
  const init = await post(`/solution-plan/init?orgId=${ORG}`, { orgId: ORG, projectId: PROJECT, opportunityId: OPP });
  log('plan init:', init.status, JSON.stringify(init.body).slice(0, 200));
  const t0 = Date.now();
  for (;;) {
    await sleep(15000);
    const sp = await get(`/solution-plan/get?orgId=${ORG}&projectId=${PROJECT}&opportunityId=${OPP}`);
    const status = sp?.plan?.status ?? sp?.status ?? JSON.stringify(sp).slice(0, 80);
    log('plan status:', status, `(${Math.round((Date.now() - t0) / 1000)}s)`);
    if (status === 'READY' || status === 'FAILED') break;
    if (Date.now() - t0 > 30 * 60 * 1000) { log('plan timeout'); break; }
  }
  const team = await get(`/solution-plan/team?orgId=${ORG}&projectId=${PROJECT}&opportunityId=${OPP}`);
  log('team:', JSON.stringify(team).slice(0, 600));
}

if (step === 'qualdoc' || step === 'all') {
  const t0 = Date.now();
  const gen = await post(`/rfp-document/generate-document?orgId=${ORG}`, {
    projectId: PROJECT, opportunityId: OPP, documentType: 'TEAM_QUALIFICATIONS',
  });
  log('qualdoc trigger:', gen.status, JSON.stringify(gen.body).slice(0, 200));
  if (gen.status < 300) {
    for (;;) {
      await sleep(5000);
      const docs = await get(`/rfp-document/list?projectId=${PROJECT}&orgId=${ORG}&opportunityId=${OPP}`);
      const tq = (docs.items ?? []).filter((d) => d.documentType === 'TEAM_QUALIFICATIONS');
      const busy = tq.some((d) => d.status === 'GENERATING' || d.status === 'RETRYING');
      log('qualdoc:', tq.map((d) => `${d.id?.slice(0, 8)}:${d.status}`).join(' '), `(${Math.round((Date.now() - t0) / 1000)}s)`);
      if (tq.length && !busy) break;
      if (Date.now() - t0 > 15 * 60 * 1000) { log('qualdoc timeout'); break; }
    }
  }
}

if (step === 'status') {
  const emp = await get(`/employee/list?orgId=${ORG}`);
  const sp = await get(`/solution-plan/get?orgId=${ORG}&projectId=${PROJECT}&opportunityId=${OPP}`);
  const team = await get(`/solution-plan/team?orgId=${ORG}&projectId=${PROJECT}&opportunityId=${OPP}`);
  const docs = await get(`/rfp-document/list?projectId=${PROJECT}&orgId=${ORG}&opportunityId=${OPP}`);
  log('employees:', emp.count);
  log('plan:', sp?.plan?.status ?? sp?.status ?? JSON.stringify(sp).slice(0, 100));
  log('team members:', team?.team?.members?.length ?? JSON.stringify(team).slice(0, 100));
  log('docs:', (docs.items ?? []).map((d) => `${d.documentType}:${d.status}:${d.id}`).join(', ') || 'none');
}
