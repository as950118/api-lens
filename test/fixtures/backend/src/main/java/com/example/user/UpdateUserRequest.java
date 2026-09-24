package com.example.user;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class UpdateUserRequest {
    private String displayName;
    private Integer age;

    public String getDisplayName() {
        return displayName;
    }

    public String getFullLabel() {
        return displayName + " (" + age + ")";
    }
}
