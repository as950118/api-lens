def report = new File(basedir, "target/tacet/report.md")
assert report.isFile()
assert report.text.contains("frontend contract check: FAIL")
assert new File(basedir, "build.log").text.contains("Tacet report:")
