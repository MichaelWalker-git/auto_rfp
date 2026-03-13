// Mock uuid module to avoid ESM transformation issues in Jest
// Generate valid UUID v4 format strings for Zod validation
const v4 = () => {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const randomHex = (length) => Array.from({ length }, hex).join('');
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)]}${randomHex(3)}-${randomHex(12)}`;
};
const v1 = v4; // Use v4 format for all versions in tests
const v3 = v4;
const v5 = v4;

module.exports = { v4, v1, v3, v5 };
module.exports.v4 = v4;
module.exports.v1 = v1;
module.exports.v3 = v3;
module.exports.v5 = v5;
module.exports.default = module.exports;
