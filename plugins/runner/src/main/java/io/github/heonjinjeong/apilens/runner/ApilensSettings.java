package io.github.heonjinjeong.apilens.runner;

import java.nio.file.Path;
import java.util.List;
import java.util.Set;

/**
 * Options of one `apilens ci` run, shared by the Gradle and Maven plugins.
 *
 * @param base git ref to compare against; null uses the backend contract stored in the index as the baseline
 * @param failOn backend change impact that fails the build: definite | likely | possible | never
 * @param checkFailOn contract check level that fails the build: error | warning | never
 * @param verifyFailOn with an AI provider, verified result that fails the build: fail | warning | never
 * @param command CLI invocation; empty to auto-detect
 */
public record ApilensSettings(
        Path frontendDir,
        Path backendDir,
        Path outputDir,
        Path indexFile,
        Path config,
        String base,
        String failOn,
        String checkFailOn,
        String verifyFailOn,
        String aiProvider,
        String aiModel,
        List<String> command,
        Path workingDir) {

    private static final Set<String> FAIL_ON = Set.of("definite", "likely", "possible", "never");
    private static final Set<String> CHECK_FAIL_ON = Set.of("error", "warning", "never");
    private static final Set<String> VERIFY_FAIL_ON = Set.of("fail", "warning", "never");

    public ApilensSettings {
        if (frontendDir == null) throw new IllegalArgumentException("ApiLens: `frontendDir` is required");
        if (backendDir == null) throw new IllegalArgumentException("ApiLens: `backendDir` is required");
        require("failOn", failOn, FAIL_ON);
        require("checkFailOn", checkFailOn, CHECK_FAIL_ON);
        require("verifyFailOn", verifyFailOn, VERIFY_FAIL_ON);
        command = command == null ? List.of() : List.copyOf(command);
    }

    private static void require(String name, String value, Set<String> allowed) {
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException("ApiLens: `" + name + "` must be one of " + allowed + " but was '" + value + "'");
        }
    }
}
