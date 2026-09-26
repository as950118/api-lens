package io.github.heonjinjeong.tacet.gradle;

import org.gradle.api.Plugin;
import org.gradle.api.Project;

/**
 * {@code plugins { id("io.github.heonjinjeong.tacet") }} adds the {@code tacet { }} extension and the
 * {@code tacetCheck} task. Attach it to {@code check} with {@code tasks.check { dependsOn("tacetCheck") }}.
 */
public class TacetPlugin implements Plugin<Project> {
    @Override
    public void apply(Project project) {
        TacetExtension ext = project.getExtensions().create("tacet", TacetExtension.class);
        ext.getBackendDir().convention(project.getLayout().getProjectDirectory());
        ext.getOutputDir().convention(project.getLayout().getBuildDirectory().dir("tacet"));
        ext.getIndexFile().convention(ext.getOutputDir().file("index.db"));
        ext.getBase().convention(project.getProviders().gradleProperty("tacet.base"));
        ext.getFailOn().convention("definite");
        ext.getCheckFailOn().convention("error");
        ext.getVerifyFailOn().convention("fail");
        ext.getAiProvider().convention(project.getProviders().gradleProperty("tacet.aiProvider"));
        ext.getIgnoreFailures().convention(false);

        project.getTasks().register("tacetCheck", TacetCheckTask.class, task -> {
            task.setGroup("verification");
            task.setDescription("Finds frontend code broken by backend API changes and checks frontend API usage (Tacet).");
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
