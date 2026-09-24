package com.example.user;

import lombok.Data;

@Data
public class UserSearchCondition {
    private String keyword;
    private Integer minAge;
    private UserStatus status;
}
