package com.example.user;

import com.example.common.BaseResponse;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDateTime;
import java.util.List;
import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class UserResponse extends BaseResponse {
    private static final long serialVersionUID = 1L;

    private Long id;
    private String name;
    private int age;
    private Profile profile;
    private UserStatus status;
    private List<String> tags;

    @JsonIgnore
    private String passwordHash;

    @JsonProperty("created_at")
    private LocalDateTime createdAt;

    private transient String cacheKey;

    @Getter
    public static class Profile {
        @NotNull
        private String email;
        private String phone;
    }
}
