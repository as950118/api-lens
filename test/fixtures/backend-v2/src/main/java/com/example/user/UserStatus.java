package com.example.user;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum UserStatus {
    ACTIVE,
    @JsonProperty("banned")
    BANNED
}
