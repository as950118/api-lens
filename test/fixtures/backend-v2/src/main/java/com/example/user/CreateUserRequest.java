package com.example.user;

import jakarta.validation.constraints.NotBlank;
import org.springframework.lang.Nullable;

public record CreateUserRequest(@NotBlank String name, int age, @Nullable String email, @NotBlank String password) {
}
