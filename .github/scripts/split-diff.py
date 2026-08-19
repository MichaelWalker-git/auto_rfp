#!/usr/bin/env python3
"""Split a unified diff into review-sized chunks, never mid-file.

The review job used to send `head -n 3000` of the diff to the model. On a large PR that
is a small fraction of the change — 3,000 of 23,699 lines on the PR this was written for,
about 13% — and the job could still return APPROVE, which reads as "reviewed and clean"
when 87% was never looked at.

Splitting on `diff --git` boundaries keeps every file's hunks together with its header, so
each chunk is a valid diff the model can reason about rather than a fragment starting
mid-hunk.

Usage: split-diff.py <diff-file> <out-dir> <max-lines-per-chunk> <max-chunks>
Prints the number of chunks written, then whether anything was dropped.
"""
import os
import sys


def main() -> int:
    diff_path, out_dir, max_lines_s, max_chunks_s = sys.argv[1:5]
    max_lines = int(max_lines_s)
    max_chunks = int(max_chunks_s)

    os.makedirs(out_dir, exist_ok=True)

    with open(diff_path, encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()

    # Group lines into per-file blocks first, so a chunk boundary can never land inside a
    # file's diff.
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if line.startswith("diff --git ") and current:
            blocks.append(current)
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append(current)

    chunks: list[list[str]] = []
    current_chunk: list[str] = []
    for block in blocks:
        # A single file larger than the budget gets its own chunk rather than being split;
        # oversized-but-whole beats valid-looking-but-truncated.
        if current_chunk and len(current_chunk) + len(block) > max_lines:
            chunks.append(current_chunk)
            current_chunk = list(block)
        else:
            current_chunk.extend(block)
    if current_chunk:
        chunks.append(current_chunk)

    dropped_chunks = 0
    if len(chunks) > max_chunks:
        dropped_chunks = len(chunks) - max_chunks
        chunks = chunks[:max_chunks]

    for i, chunk in enumerate(chunks):
        with open(os.path.join(out_dir, f"chunk-{i:03d}.diff"), "w", encoding="utf-8") as fh:
            fh.writelines(chunk)

    dropped_files = 0
    if dropped_chunks:
        seen = sum(
            1
            for c in chunks
            for line in c
            if line.startswith("diff --git ")
        )
        total = sum(1 for line in lines if line.startswith("diff --git "))
        dropped_files = total - seen

    print(len(chunks))
    print(dropped_files)
    return 0


if __name__ == "__main__":
    sys.exit(main())
