const sharedConfig = require("../../libs/shared/jest.config.ts.js");

/** @type {import('jest').Config} */
module.exports = {
  ...sharedConfig,
  displayName: "browser-lite tests",
  testEnvironment: "node",
};
