FROM rust:1.97-bookworm AS build
WORKDIR /src
COPY . .
ARG TABLE_HOUSE_RELEASE_JSON
RUN test -n "$TABLE_HOUSE_RELEASE_JSON" && cargo build --locked --release -p house-seller --bin house-seller
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates util-linux && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/table && chown 65534:65534 /var/lib/table
COPY --from=build /src/target/release/house-seller /usr/local/bin/house-seller
COPY services/house-seller/entrypoint.sh /usr/local/bin/table-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/table-entrypoint && chmod 755 /usr/local/bin/table-entrypoint
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/table-entrypoint"]
