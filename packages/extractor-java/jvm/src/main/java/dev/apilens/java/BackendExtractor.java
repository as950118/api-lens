package dev.apilens.java;

import dev.apilens.java.model.Manifest.BackendManifest;
import dev.apilens.java.model.Manifest.EndpointInfo;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Produces a {@link BackendManifest} for a Spring backend source tree. */
public final class BackendExtractor {

    public BackendManifest extract(Path rootDir) throws IOException {
        Path root = rootDir.toAbsolutePath().normalize();
        List<String> warnings = new ArrayList<>();
        SourceIndex index = SourceIndex.load(root, warnings);
        TypeModel types = new TypeModel(index, warnings);
        List<EndpointInfo> endpoints = new SpringEndpointExtractor(index, types, warnings).extract();
        return new BackendManifest(
                "java", root.toString(), Instant.now().toString(), endpoints, types.dtos(), types.enums(),
                List.copyOf(warnings));
    }
}
