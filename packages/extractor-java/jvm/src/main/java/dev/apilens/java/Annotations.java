package dev.apilens.java;

import com.github.javaparser.ast.expr.AnnotationExpr;
import com.github.javaparser.ast.expr.ArrayInitializerExpr;
import com.github.javaparser.ast.expr.BooleanLiteralExpr;
import com.github.javaparser.ast.expr.Expression;
import com.github.javaparser.ast.expr.MemberValuePair;
import com.github.javaparser.ast.expr.NormalAnnotationExpr;
import com.github.javaparser.ast.expr.SingleMemberAnnotationExpr;
import com.github.javaparser.ast.nodeTypes.NodeWithAnnotations;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Annotation lookup by simple name, so both `@GetMapping` and `@org.springframework...GetMapping` match. */
final class Annotations {
    private Annotations() {}

    static Optional<AnnotationExpr> find(NodeWithAnnotations<?> node, Set<String> names) {
        return node.getAnnotations().stream()
                .filter(a -> names.contains(simpleName(a.getNameAsString())))
                .findFirst();
    }

    static Optional<AnnotationExpr> find(NodeWithAnnotations<?> node, String name) {
        return find(node, Set.of(name));
    }

    static boolean has(NodeWithAnnotations<?> node, String... names) {
        return find(node, Set.of(names)).isPresent();
    }

    /** Attribute value; `value` also matches the single-member form `@X("...")`. */
    static Optional<Expression> attribute(AnnotationExpr annotation, String... names) {
        List<String> wanted = List.of(names);
        if (annotation instanceof SingleMemberAnnotationExpr single) {
            return wanted.contains("value") ? Optional.of(single.getMemberValue()) : Optional.empty();
        }
        if (annotation instanceof NormalAnnotationExpr normal) {
            for (MemberValuePair pair : normal.getPairs()) {
                if (wanted.contains(pair.getNameAsString())) return Optional.of(pair.getValue());
            }
        }
        return Optional.empty();
    }

    static Optional<Boolean> booleanAttribute(AnnotationExpr annotation, String name) {
        return attribute(annotation, name)
                .filter(BooleanLiteralExpr.class::isInstance)
                .map(e -> ((BooleanLiteralExpr) e).getValue());
    }

    static List<Expression> elements(Expression expression) {
        return expression instanceof ArrayInitializerExpr array ? array.getValues() : List.of(expression);
    }

    static String simpleName(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? name : name.substring(dot + 1);
    }
}
