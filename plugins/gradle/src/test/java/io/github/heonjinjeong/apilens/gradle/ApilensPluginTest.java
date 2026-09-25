package io.github.heonjinjeong.apilens.gradle;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.gradle.testkit.runner.BuildResult;
import org.gradle.testkit.runner.GradleRunner;
import org.gradle.testkit.runner.TaskOutcome;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ApilensPluginTest {
    private static final Path REPO = Path.of(System.getProperty("apilens.repo"));
    private static final Path FIXTURES = REPO.resolve("test/fixtures");
    private static final Path CLI = REPO.resolve("packages/cli/dist/bin.js");

    @TempDir
    Path project;

    private void buildFile(String backend, String extra) throws IOException {
        Files.writeString(project.resolve("settings.gradle.kts"), "rootProject.name = \"backend\"\n");
        Files.writeString(project.resolve("build.gradle.kts"), """
                plugins { id("io.github.heonjinjeong.apilens") }
                apilens {
                    frontendDir.set(file("%s"))
                    backendDir.set(file("%s"))
                    config.set(file("%s"))
                    checkFailOn.set("never")
                    command.set(listOf("node", "%s"))
                    %s
                }
                """.formatted(FIXTURES.resolve("frontend"), FIXTURES.resolve(backend),
                FIXTURES.resolve("apilens.config.json"), CLI, extra));
    }

    private GradleRunner runner(String... args) {
        return GradleRunner.create().withProjectDir(project.toFile()).withPluginClasspath().withArguments(args).forwardOutput();
    }

    @Test
    void storesTheBaselineThenFailsTheBuildOnBreakingChanges() throws IOException {
        buildFile("backend", "");
        BuildResult first = runner("apilensCheck", "--configuration-cache").build();
        assertEquals(TaskOutcome.SUCCESS, first.task(":apilensCheck").getOutcome());
        assertTrue(Files.readString(project.resolve("build/apilens/report.md")).contains("No git base ref"));

        buildFile("backend-v2", "");
        BuildResult second = runner("apilensCheck", "--configuration-cache").buildAndFail();
        assertTrue(second.getOutput().contains("ApiLens found problems at the configured failure level"), second.getOutput());
        assertTrue(Files.readString(project.resolve("build/apilens/report.md")).contains("backend API change report: FAIL"));
    }

    @Test
    void ignoreFailuresOnlyWarns() throws IOException {
        buildFile("backend", "");
        runner("apilensCheck").build();
        buildFile("backend-v2", "ignoreFailures.set(true)");
        BuildResult result = runner("apilensCheck").build();
        assertTrue(result.getOutput().contains("ApiLens found problems"), result.getOutput());
    }

    @Test
    void rejectsInvalidOptions() throws IOException {
        buildFile("backend", "failOn.set(\"sometimes\")");
        BuildResult result = runner("apilensCheck").buildAndFail();
        assertTrue(result.getOutput().contains("`failOn` must be one of"), result.getOutput());
    }
}
