def log = new File(basedir, "build.log").text
assert log.contains("ApiLens found problems at the configured failure level")
assert new File(basedir, "target/apilens/report.md").text.contains("ProductResponse") == false
assert new File(basedir, "target/apilens/contract.md").text.contains("ENDPOINT_NOT_FOUND") == false
assert new File(basedir, "target/apilens/contract.md").text.contains("Backend has no endpoint for GET /orders")
