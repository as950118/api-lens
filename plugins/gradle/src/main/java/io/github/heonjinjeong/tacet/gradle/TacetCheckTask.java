package io.github.heonjinjeong.tacet.gradle;

import io.github.heonjinjeong.tacet.runner.TacetRunner;
import io.github.heonjinjeong.tacet.runner.TacetSettings;
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

/** Runs `tacet ci`: frontend index, backend API change impact and contract check. */
@DisableCachingByDefault(because = "Reads the frontend, the backend and git state outside Gradle's inputs")
public abstract class TacetCheckTask extends DefaultTask {

    public TacetCheckTask() {
        doNotTrackState("Tacet compares against git refs and a stored baseline contract");
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
            throw new GradleException("Tacet: set tacet { frontendDir = file(\"...\") }");
        }
        TacetSettings settings;
        try {
            settings = new TacetSettings(
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

        TacetRunner.Result result;
        try {
            result = TacetRunner.run(settings, System.getenv(), line -> getLogger().lifecycle(line));
        } catch (IllegalStateException e) {
            throw new GradleException(e.getMessage(), e);
        }
        Path report = result.report();
        if (result.failed()) {
            String message = "Tacet found problems at the configured failure level. Report: " + report.toUri();
            if (getIgnoreFailures().get()) getLogger().warn(message);
            else throw new GradleException(message);
        } else {
            getLogger().lifecycle("Tacet report: " + report.toUri());
        }
    }
}
