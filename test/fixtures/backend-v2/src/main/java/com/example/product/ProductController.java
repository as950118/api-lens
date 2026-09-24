package com.example.product;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
@RequestMapping("/products")
public class ProductController {

    @GetMapping("/{id}")
    @ResponseBody
    public ProductResponse getProduct(@PathVariable long id) {
        return null;
    }

    @GetMapping("/{id}/page")
    public String productPage(@PathVariable long id) {
        return "product";
    }
}
