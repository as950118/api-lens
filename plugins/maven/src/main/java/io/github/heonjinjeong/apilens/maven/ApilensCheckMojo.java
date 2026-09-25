package io.github.heonjinjeong.apilens.maven;

import io.github.heonjinjeong.apilens.runner.ApilensRunner;
import io.github.heonjinjeong.apilens.runner.ApilensSettings;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import org.apache.maven.plugin.AbstractMojo;
import org.apache.maven.plugin.MojoExecutionException;
import org.apache.maven.plugin.MojoFailureException;
import org.apache.maven.plugins.annotations.LifecyclePhase;
import org.apache.maven.plugins.annotations.Mojo;
import org.apache.maven.plugins.annotations.Parameter;

/**
 * Runs {@code apilens ci}: frontend index, backend API change impact and contract check of changed frontend
 * files. Fails the build at the configured levels.
 */
@Mojo(name = "check", defaultPhase = LifecyclePhase.VERIFY, threadSafe = true)
public class ApilensCheckMojo extends AbstractMojo {

    /** TypeScript frontend project root. */
    @Parameter(property = "apilens.frontendDir", required = true)
    private File frontendDir;

    /** Spring Boot backend project root. */
    @Parameter(property = "apilens.backendDir", defaultValue = "${project.basedir}")
    private File backendDir;

    /** Report directory. */
    @Parameter(property = "apilens.outputDir", defaultValue = "${project.build.directory}/apilens")
    private File outputDir;

    /** Index database; keeps the baseline contract between builds. Default: outputDir/index.db. */
    @Parameter(property = "apilens.indexFile")
    private File indexFile;

    /** apilens.config.json. Default: frontendDir/apilens.config.json when present. */
    @Parameter(property = "apilens.config")
    private File config;

    /** Git ref to compare against, e.g. origin/main. Without it the stored baseline contract is used. */
    @Parameter(property = "apilens.base")
    private String base;

    /** Backend change impact that fails the build: definite, likely, possible or never. */
    @Parameter(property = "apilens.failOn", defaultValue = "definite")
    private String failOn;

    /** Contract check level that fails the build: error, warning or never. */
    @Parameter(property = "apilens.checkFailOn", defaultValue = "error")
    private String checkFailOn;

    /** With an AI provider, verified result that fails the build: fail, warning or never. */
    @Parameter(property = "apilens.verifyFailOn", defaultValue = "fail")
    private String verifyFailOn;

    /** Verify undecided findings with AI, e.g. anthropic (credentials from the environment). */
    @Parameter(property = "apilens.aiProvider")
    private String aiProvider;

    @Parameter(property = "apilens.aiModel")
    private String aiModel;

    /** CLI invocation. Default: apilens on PATH, else npx --yes @apilens/cli at this plugin's version. */
    @Parameter
    private List<String> command;

    /** CLI invocation as one space-separated string (for -D on the command line). */
    @Parameter(property = "apilens.command")
    private String commandLine;

    /** Report problems without failing the build. */
    @Parameter(property = "apilens.ignoreFailures", defaultValue = "false")
    private boolean ignoreFailures;

    @Parameter(property = "apilens.skip", defaultValue = "false")
    private boolean skip;

    @Parameter(defaultValue = "${project.basedir}", readonly = true, required = true)
    private File basedir;

    @Override
    public void execute() throws MojoExecutionException, MojoFailureException {
        if (skip) {
            getLog().info("ApiLens skipped");
            return;
        }
        List<String> cli = command != null && !command.isEmpty()
                ? command
                : commandLine != null && !commandLine.isBlank() ? Arrays.asList(commandLine.trim().split("\\s+")) : List.of();
        ApiLensResult result = run(cli);
        if (result.failed) {
            String message = "ApiLens found problems at the configured failure level. Report: " + result.report;
            if (ignoreFailures) getLog().warn(message);
            else throw new MojoFailureException(message);
        } else {
            getLog().info("ApiLens report: " + result.report);
        }
    }

    private record ApiLensResult(boolean failed, String report) {}

    private ApiLensResult run(List<String> cli) throws MojoExecutionException {
        try {
            ApilensSettings settings = new ApilensSettings(
                    frontendDir.toPath(),
                    backendDir.toPath(),
                    outputDir.toPath(),
                    (indexFile != null ? indexFile : new File(outputDir, "index.db")).toPath(),
                    config != null ? config.toPath() : null,
                    base,
                    failOn,
                    checkFailOn,
                    verifyFailOn,
                    aiProvider,
                    aiModel,
                    cli,
                    basedir.toPath());
            ApilensRunner.Result result = ApilensRunner.run(settings, System.getenv(), line -> getLog().info(line));
            return new ApiLensResult(result.failed(), result.report().toUri().toString());
        } catch (IllegalArgumentException | IllegalStateException e) {
            throw new MojoExecutionException(e.getMessage(), e);
        } catch (IOException e) {
            throw new MojoExecutionException("ApiLens failed: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MojoExecutionException("ApiLens was interrupted", e);
        }
    }
}
