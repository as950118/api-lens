package io.github.heonjinjeong.apilens.gradle;

import io.github.heonjinjeong.apilens.runner.ApilensRunner;
import io.github.heonjinjeong.apilens.runner.ApilensSettings;
import java.io.IOException;
import java.nio.file.Path;
import org.gradle.api.DefaultTask;
import org.gradle.api.GradleException;
import org.gradle.api.file.DirectoryProperty;
import org.gradle.api.file.RegularFile;
import org.gradle.api.file.RegularFileProperty;
import org.gradle.api.provider.ListProperty;
import org.gradle.api.provider.Property;
import org.gradle.api.tasks.Internal;
import org.gradle.api.tasks.TaskAction;
import org.gradle.work.DisableCachingByDefault;

/** Runs `apilens ci`: frontend index, backend API change impact and contract check. */
@DisableCachingByDefault(because = "Reads the frontend, the backend and git state outside Gradle's inputs")
public abstract class ApilensCheckTask extends DefaultTask {

    public ApilensCheckTask() {
        doNotTrackState("ApiLens compares against git refs and a stored baseline contract");
    }

    @Internal public abstract DirectoryProperty getFrontendDir();
    @Internal public abstract DirectoryProperty getBackendDir();
    @Internal public abstract DirectoryProperty getOutputDir();
    @Internal public abstract RegularFileProperty getIndexFile();
    @Internal public abstract RegularFileProperty getConfig();
    @Internal public abstract Property<String> getBase();
    @Internal public abstract Property<String> getFailOn();
    @Internal public abstract Property<String> getCheckFailOn();
    @Internal public abstract Property<String> getVerifyFailOn();
    @Internal public abstract Property<String> getAiProvider();
    @Internal public abstract Property<String> getAiModel();
    @Internal public abstract ListProperty<String> getCommand();
    @Internal public abstract Property<Boolean> getIgnoreFailures();
    @Internal public abstract DirectoryProperty getWorkingDir();

    @TaskAction
    public void run() throws IOException, InterruptedException {
        if (!getFrontendDir().isPresent()) {
            throw new GradleException("ApiLens: set apilens { frontendDir = file(\"...\") }");
        }
        ApilensSettings settings;
        try {
            settings = new ApilensSettings(
                    getFrontendDir().get().getAsFile().toPath(),
                    getBackendDir().get().getAsFile().toPath(),
                    getOutputDir().get().getAsFile().toPath(),
                    getIndexFile().get().getAsFile().toPath(),
                    getConfig().map(RegularFile::getAsFile).map(f -> f.toPath()).getOrNull(),
                    getBase().getOrNull(),
                    getFailOn().get(),
                    getCheckFailOn().get(),
                    getVerifyFailOn().get(),
                    getAiProvider().getOrNull(),
                    getAiModel().getOrNull(),
                    getCommand().get(),
                    getWorkingDir().get().getAsFile().toPath());
        } catch (IllegalArgumentException e) {
            throw new GradleException(e.getMessage(), e);
        }

        ApilensRunner.Result result;
        try {
            result = ApilensRunner.run(settings, System.getenv(), line -> getLogger().lifecycle(line));
        } catch (IllegalStateException e) {
            throw new GradleException(e.getMessage(), e);
        }
        Path report = result.report();
        if (result.failed()) {
            String message = "ApiLens found problems at the configured failure level. Report: " + report.toUri();
            if (getIgnoreFailures().get()) getLogger().warn(message);
            else throw new GradleException(message);
        } else {
            getLogger().lifecycle("ApiLens report: " + report.toUri());
        }
    }
}
