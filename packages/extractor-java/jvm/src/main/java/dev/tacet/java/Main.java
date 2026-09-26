package dev.tacet.java;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonSerializer;
import dev.tacet.java.model.Manifest.BackendManifest;
import dev.tacet.java.model.TypeRef;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Tacet extractor protocol entry point: `java -jar tacet-java-extractor.jar <rootDir>`
 * prints one BackendManifest JSON document to stdout. Diagnostics go to stderr.
 */
public final class Main {
    private Main() {}

    public static void main(String[] args) {
        if (args.length != 1) {
            System.err.println("Usage: java -jar tacet-java-extractor.jar <backendRootDir>");
            System.exit(2);
        }
        Path root = Path.of(args[0]);
        if (!Files.isDirectory(root)) {
            System.err.println("Backend directory not found: " + root.toAbsolutePath());
            System.exit(2);
        }
        try {
            BackendManifest manifest = new BackendExtractor().extract(root);
            PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
            out.println(toJson(manifest));
        } catch (IOException e) {
            System.err.println("Failed to read backend sources: " + e.getMessage());
            System.exit(1);
        }
    }

    static String toJson(BackendManifest manifest) {
        return gson().toJson(manifest);
    }

    private static Gson gson() {
        return new GsonBuilder()
                .serializeNulls()
                .disableHtmlEscaping()
                // Values declared as the TypeRef interface must serialize with their concrete record's components.
                .registerTypeHierarchyAdapter(TypeRef.class, (JsonSerializer<TypeRef>) (src, type, ctx) -> {
                    JsonObject json = new JsonObject();
                    for (RecordComponent component : src.getClass().getRecordComponents()) {
                        json.add(component.getName(), ctx.serialize(read(component, src)));
                    }
                    return json;
                })
                .create();
    }

    private static Object read(RecordComponent component, Object record) {
        try {
            return component.getAccessor().invoke(record);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot read " + component.getName(), e);
        }
    }
}
