package com.example.user;

import com.example.api.ApiPaths;
import com.example.common.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(ApiPaths.USERS)
public class UserController {

    @GetMapping("/{id}")
    public UserResponse getUser(@PathVariable Long id) {
        return null;
    }

    @GetMapping
    public List<UserResponse> listUsers(
            @RequestParam(required = false) String name,
            @RequestParam(defaultValue = "0") int page) {
        return List.of();
    }

    @PostMapping
    public ResponseEntity<UserResponse> createUser(@Valid @RequestBody CreateUserRequest request) {
        return null;
    }

    @PutMapping("/{id}")
    public ApiResponse<UserResponse> updateUser(
            @PathVariable("id") Long userId, @RequestBody UpdateUserRequest request) {
        return null;
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        return ResponseEntity.noContent().build();
    }

    @RequestMapping(value = "/{id}/status", method = RequestMethod.PATCH)
    public UserStatus changeStatus(@PathVariable Long id, @RequestHeader("X-Actor") String actor) {
        return UserStatus.ACTIVE;
    }

    @GetMapping("/search")
    public Page<UserResponse> search(UserSearchCondition condition, Pageable pageable) {
        return Page.empty();
    }

    @GetMapping("/summary")
    public List<UserSummary> summaries() {
        return List.of();
    }

    private void notAnEndpoint() {
    }
}
