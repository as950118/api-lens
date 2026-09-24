package com.example.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;

@FeignClient(name = "payment")
public interface PaymentClient {
    @GetMapping("/payments")
    String listPayments();
}
