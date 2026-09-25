package io.github.heonjinjeong.apilens.gradle;

import org.gradle.api.Plugin;
import org.gradle.api.Project;

/**
 * {@code plugins { id("io.github.heonjinjeong.apilens") }} adds the {@code apilens { }} extension and the
 * {@code apilensCheck} task. Attach it to {@code check} with {@code tasks.check { dependsOn("apilensCheck") }}.
 */
public class ApilensPlugin implements Plugin<Project> {
    @Override
    public void apply(Project project) {
        ApilensExtension ext = project.getExtensions().create("apilens", ApilensExtension.class);
        ext.getBackendDir().convention(project.getLayout().getProjectDirectory());
        ext.getOutputDir().convention(project.getLayout().getBuildDirectory().dir("apilens"));
        ext.getIndexFile().convention(ext.getOutputDir().file("index.db"));
        ext.getBase().convention(project.getProviders().gradleProperty("apilens.base"));
        ext.getFailOn().convention("definite");
        ext.getCheckFailOn().convention("error");
        ext.getVerifyFailOn().convention("fail");
        ext.getAiProvider().convention(project.getProviders().gradleProperty("apilens.aiProvider"));
        ext.getIgnoreFailures().convention(false);

        project.getTasks().register("apilensCheck", ApilensCheckTask.class, task -> {
            task.setGroup("verification");
            task.setDescription("Finds frontend code broken by backend API changes and checks frontend API usage (ApiLens).");
            task.getFrontendDir().set(ext.getFrontendDir());
            task.getBackendDir().set(ext.getBackendDir());
            task.getOutputDir().set(ext.getOutputDir());
            task.getIndexFile().set(ext.getIndexFile());
            task.getConfig().set(ext.getConfig());
            task.getBase().set(ext.getBase());
            task.getFailOn().set(ext.getFailOn());
            task.getCheckFailOn().set(ext.getCheckFailOn());
            task.getVerifyFailOn().set(ext.getVerifyFailOn());
            task.getAiProvider().set(ext.getAiProvider());
            task.getAiModel().set(ext.getAiModel());
            task.getCommand().set(ext.getCommand());
            task.getIgnoreFailures().set(ext.getIgnoreFailures());
            task.getWorkingDir().set(project.getLayout().getProjectDirectory());
        });
    }
}
