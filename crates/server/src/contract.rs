use utoipa::openapi::{
    ContentBuilder, Ref, ResponseBuilder,
    security::{ApiKey, ApiKeyValue, Http, HttpAuthScheme, SecurityScheme},
};

/// Routes and schemas come from the same registrations used by the HTTP server.
pub fn document() -> utoipa::openapi::OpenApi {
    let (_, mut api) = super::api_router().split_for_parts();
    api.info.title = "Wuling HTTP API".into();
    api.info.version = env!("CARGO_PKG_VERSION").into();
    api.info.description = Some(
        "Browser requests use HttpOnly cookies. All writes require the exact configured \
         WULING_WEB_ORIGIN in Origin. PATs only authorize repository reads. \
         Historical collaboration writes return 503. IDs are PostgreSQL int64; \
         JavaScript consumers must reject values outside the safe integer range."
            .into(),
    );
    api.security = Some(vec![utoipa::openapi::security::SecurityRequirement::new(
        "sessionCookie",
        Vec::<String>::new(),
    )]);
    let components = api.components.get_or_insert_with(Default::default);
    components.schemas.insert(
        "ApiError".into(),
        <super::ApiError as utoipa::PartialSchema>::schema(),
    );
    components.add_security_scheme(
        "sessionCookie",
        SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::new("wuling_session"))),
    );
    components.add_security_scheme(
        "refreshCookie",
        SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::new("wuling_refresh"))),
    );
    components.add_security_scheme(
        "personalToken",
        SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
    );
    for path in api.paths.paths.values_mut() {
        for operation in [
            &mut path.get,
            &mut path.post,
            &mut path.put,
            &mut path.patch,
            &mut path.delete,
        ]
        .into_iter()
        .flatten()
        {
            for (status, description) in [
                ("400", "Invalid request"),
                ("401", "Login required or credentials expired"),
                ("403", "Origin or permissions denied"),
                ("404", "Resource missing or not visible to this identity"),
                ("409", "Resource conflict or Git operation failed"),
                ("500", "Database or Git operation failed"),
            ] {
                operation
                    .responses
                    .responses
                    .entry(status.into())
                    .or_insert_with(|| {
                        ResponseBuilder::new()
                            .description(description)
                            .content(
                                "application/json",
                                ContentBuilder::new()
                                    .schema(Some(Ref::from_schema_name("ApiError")))
                                    .build(),
                            )
                            .build()
                            .into()
                    });
            }
            // Axum extractor rejections are plain text, not the domain error envelope.
            for status in ["415", "422"] {
                operation
                    .responses
                    .responses
                    .entry(status.into())
                    .or_insert_with(|| {
                        ResponseBuilder::new()
                            .description("Axum request extraction failed (plain text)")
                            .content(
                                "text/plain",
                                ContentBuilder::new()
                                    .schema(Some(
                                        utoipa::openapi::ObjectBuilder::new()
                                            .schema_type(utoipa::openapi::Type::String),
                                    ))
                                    .build(),
                            )
                            .build()
                            .into()
                    });
            }
        }
    }
    api
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn swagger_and_contract_are_served_without_a_database() {
        let router: Router = Router::new().merge(
            utoipa_swagger_ui::SwaggerUi::new("/api/docs")
                .url("/api/openapi.json", super::document()),
        );
        for (path, expected) in [
            ("/api/docs/", "swagger-ui"),
            ("/api/openapi.json", "\"openapi\":\"3.1.0\""),
        ] {
            let response = router
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), 200);
            let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
            assert!(String::from_utf8_lossy(&body).contains(expected));
        }
    }

    #[test]
    fn contract_contains_registered_operations_and_security() {
        let api = serde_json::to_value(super::document()).unwrap();
        assert_eq!(api["openapi"], "3.1.0");
        assert_eq!(api["paths"].as_object().unwrap().len(), 19);
        assert!(api["paths"]["/api/repos/{id}/{kind}"]["post"]["responses"]["503"].is_object());
        assert!(api["paths"]["/api/auth/tokens"]["post"]["responses"]["201"].is_object());
        assert_eq!(
            api["components"]["securitySchemes"]["sessionCookie"]["in"],
            "cookie"
        );
        assert_eq!(
            api["components"]["schemas"]["TokenScope"]["enum"],
            serde_json::json!(["read", "write"])
        );
    }
}
