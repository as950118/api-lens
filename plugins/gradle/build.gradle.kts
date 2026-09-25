plugins {
    `java-gradle-plugin`
    id("com.gradle.plugin-publish") version "1.3.1"
    signing
}

group = "io.github.heonjinjeong"
description = "Run ApiLens in Gradle builds: find frontend code broken by backend API changes"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 17
    options.encoding = "UTF-8"
}

// The runner is shared with the Maven plugin as source, not as a separate artifact.
val generateVersion = tasks.register("generateApilensVersion") {
    val out = layout.buildDirectory.dir("generated/apilens")
    val pluginVersion = project.version.toString()
    inputs.property("version", pluginVersion)
    outputs.dir(out)
    doLast {
        val file = out.get().file("io/github/heonjinjeong/apilens/runner/apilens.properties").asFile
        file.parentFile.mkdirs()
        file.writeText("version=$pluginVersion\n")
    }
}
sourceSets.main {
    java.srcDir("../runner/src/main/java")
    resources.srcDir(generateVersion)
}

gradlePlugin {
    website = "https://github.com/heonjinjeong/api-lens"
    vcsUrl = "https://github.com/heonjinjeong/api-lens"
    plugins {
        create("apilens") {
            id = "io.github.heonjinjeong.apilens"
            implementationClass = "io.github.heonjinjeong.apilens.gradle.ApilensPlugin"
            displayName = "ApiLens"
            description = project.description
            tags = listOf("api", "breaking-changes", "contract-testing", "spring-boot", "typescript", "static-analysis")
        }
    }
}

signing {
    val key = providers.environmentVariable("SIGNING_KEY").orNull
    if (key != null) useInMemoryPgpKeys(key, providers.environmentVariable("SIGNING_PASSWORD").orNull)
    isRequired = key != null
}

tasks.test {
    useJUnitPlatform()
    systemProperty("apilens.repo", rootDir.resolve("../..").canonicalPath)
}

tasks.javadoc {
    (options as StandardJavadocDocletOptions).addStringOption("Xdoclint:all,-missing", "-quiet")
}
