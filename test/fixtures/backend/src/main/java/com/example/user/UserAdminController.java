package com.example.user;

import static com.example.api.ApiPaths.ADMIN;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserAdminController {

    @DeleteMapping(ADMIN + "/{id}/sessions")
    public void revokeSessions(@PathVariable Long id) {
    }
}
