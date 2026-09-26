package dev.tacet.java.model;

import java.util.List;

/** Mirrors `TypeRef` in packages/core/src/ir/types.ts. `kind` is serialized as the JSON discriminator. */
public sealed interface TypeRef {

    record Scalar(String kind, String name) implements TypeRef {}

    record Dto(String kind, String dtoId, List<TypeRef> typeArguments) implements TypeRef {}

    record EnumRef(String kind, String enumId) implements TypeRef {}

    record ArrayOf(String kind, TypeRef element) implements TypeRef {}

    record MapOf(String kind, TypeRef value) implements TypeRef {}

    record TypeParameter(String kind, String name) implements TypeRef {}

    record Unknown(String kind, String name) implements TypeRef {}

    static TypeRef scalar(String name) {
        return new Scalar("scalar", name);
    }

    static TypeRef dto(String dtoId, List<TypeRef> typeArguments) {
        return new Dto("dto", dtoId, List.copyOf(typeArguments));
    }

    static TypeRef enumRef(String enumId) {
        return new EnumRef("enum", enumId);
    }

    static TypeRef array(TypeRef element) {
        return new ArrayOf("array", element);
    }

    static TypeRef map(TypeRef value) {
        return new MapOf("map", value);
    }

    static TypeRef typeParameter(String name) {
        return new TypeParameter("typeParameter", name);
    }

    static TypeRef unknown(String name) {
        return new Unknown("unknown", name);
    }
}
