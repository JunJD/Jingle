/** @type {import('@cucumber/cucumber').IProfiles} */
module.exports = {
  default: {
    format: ["progress-bar", "summary", "json:test-results/bdd/cucumber.json"],
    formatOptions: {
      snippetInterface: "async-await"
    },
    parallel: 1,
    publishQuiet: true,
    require: ["tests/bdd/steps/**/*.ts", "tests/bdd/support/**/*.ts"],
    requireModule: ["tsx/cjs"],
    tags: "not @skip"
  }
}
