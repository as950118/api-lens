package com.example.product;

import java.math.BigDecimal;
import java.util.Map;

public record ProductResponse(long id, BigDecimal price, Map<String, String> attributes) {
}
