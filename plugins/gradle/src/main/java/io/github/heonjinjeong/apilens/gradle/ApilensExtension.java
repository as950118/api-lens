package io.github.heonjinjeong.apilens.gradle;

import org.gradle.api.file.DirectoryProperty;
import org.gradle.api.file.RegularFileProperty;
import org.gradle.api.provider.ListProperty;
import org.gradle.api.provider.Property;

/** The apilens { } block. */
public abstract class ApilensExtension {
    /** TypeScript frontend project root (required). */
    public abstract DirectoryProperty getFrontendDir();

    /** Spring Boot backend project root. Default: this project's directory. */
    public abstract DirectoryProperty getBackendDir();

    /** Report directory. Default: build/apilens. */
    public abstract DirectoryProperty getOutputDir();

    /** Index database. Default: build/apilens/index.db (keeps the baseline contract between builds). */
    public abstract RegularFileProperty getIndexFile();

    /** apilens.config.json. Default: frontendDir/apilens.config.json when present. */
    public abstract RegularFileProperty getConfig();

    /** Git ref to compare against, e.g. origin/main. Default: -Papilens.base, else the stored baseline contract. */
    public abstract Property<String> getBase();

    /** Backend change impact that fails the build: definite | likely | possible | never. Default: definite. */
    public abstract Property<String> getFailOn();

    /** Contract check level that fails the build: error | warning | never. Default: error. */
    public abstract Property<String> getCheckFailOn();

    /** With an AI provider, verified result that fails the build: fail | warning | never. Default: fail. */
    public abstract Property<String> getVerifyFailOn();

    /** Verify undecided findings with AI, e.g. "anthropic" (credentials from the environment). */
    public abstract Property<String> getAiProvider();

    public abstract Property<String> getAiModel();

    /** CLI invocation. Default: {@code apilens} on PATH, else {@code npx --yes @apilens/cli@VERSION} (this plugin's version). */
    public abstract ListProperty<String> getCommand();

    /** Report problems without failing the build. Default: false. */
    public abstract Property<Boolean> getIgnoreFailures();
}
