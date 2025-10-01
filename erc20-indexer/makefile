# ===== Load .env if present =====
ifneq (,$(wildcard .env))
include .env
export
endif

# ===== Config =====
NAMESPACE        ?= erc20
DOCKER_USER      ?= abth21
API_TAG          ?= v2
WATCHER_TAG      ?= v1

ETHERSCAN_API_KEY ?=
WATCH_ADDRESS     ?=
PG_APP_PASSWORD   ?= secret

K8S_DIR      ?= k8s
POSTGRES_YAML := $(K8S_DIR)/postgres.yaml
WATCHER_YAML  := $(K8S_DIR)/chain-watcher.yaml
API_YAML      := $(K8S_DIR)/indexer-api.yaml
INGRESS_YAML  := $(K8S_DIR)/ingress.yaml
HPA_API_YAML  := $(K8S_DIR)/indexer-api-hpa.yaml
HPA_WAT_YAML  := $(K8S_DIR)/chain-watcher-hpa.yaml

API_IMAGE     := $(DOCKER_USER)/indexer-api:$(API_TAG)
WATCHER_IMAGE := $(DOCKER_USER)/chain-watcher:$(WATCHER_TAG)

SCHEMA_FILE   := db/schema.sql

SHELL := /bin/bash
.ONESHELL:
.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' Makefile | sort | awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ===== Setup / Init =====
.PHONY: ns
ns: ## create namespace if missing
	kubectl get ns $(NAMESPACE) >/dev/null 2>&1 || kubectl create ns $(NAMESPACE)

.PHONY: secrets
secrets: ns ## create/update app secrets
	@if [ -z "$(ETHERSCAN_API_KEY)" ] || [ -z "$(WATCH_ADDRESS)" ]; then \
	  echo ">> Set ETHERSCAN_API_KEY and WATCH_ADDRESS (in .env or as make vars)"; exit 1; fi
	kubectl -n $(NAMESPACE) create secret generic pg-secret \
	  --from-literal=APP_PASSWORD=$(PG_APP_PASSWORD) \
	  --from-literal=POSTGRES_PASSWORD=$(PG_APP_PASSWORD) \
	  --dry-run=client -o yaml | kubectl apply -f -
	kubectl -n $(NAMESPACE) create secret generic watcher-secret \
	  --from-literal=ETHERSCAN_API_KEY=$(ETHERSCAN_API_KEY) \
	  --from-literal=WATCH_ADDRESS=$(WATCH_ADDRESS) \
	  --dry-run=client -o yaml | kubectl apply -f -

.PHONY: metrics
metrics: ## install metrics-server (if not present)
	kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

.PHONY: init
init: ns secrets metrics ## full cluster init

# ===== Build & Push =====
.PHONY: build-api
build-api: ## build indexer-api image
	cd indexer-api && docker build -t $(API_IMAGE) .

.PHONY: push-api
push-api: ## push indexer-api image
	docker push $(API_IMAGE)

.PHONY: build-watcher
build-watcher: ## build chain-watcher image
	cd chain-watcher && docker build -t $(WATCHER_IMAGE) .

.PHONY: push-watcher
push-watcher: ## push chain-watcher image
	docker push $(WATCHER_IMAGE)

.PHONY: build-all
build-all: build-api build-watcher

.PHONY: push-all
push-all: push-api push-watcher

# ===== Deploy pieces =====
.PHONY: apply-postgres
apply-postgres: ns ## deploy Postgres
	kubectl apply -f $(POSTGRES_YAML)
	kubectl -n $(NAMESPACE) rollout status deploy/postgres

.PHONY: db-apply
db-apply: ## apply DB schema from db/schema.sql
	@if [ ! -f "$(SCHEMA_FILE)" ]; then echo "Missing $(SCHEMA_FILE)"; exit 1; fi
	# vänta tills service/deploy är redo
	kubectl -n $(NAMESPACE) rollout status deploy/postgres
	# kör schema inuti Postgres:
	kubectl -n $(NAMESPACE) exec -i deploy/postgres -- psql -U app -d appdb -f - < $(SCHEMA_FILE)
	@echo ">> Schema applied."

.PHONY: apply-watcher
apply-watcher: ns ## deploy chain-watcher
	sed -E -e "s|image: .*/chain-watcher:.*|image: $(WATCHER_IMAGE)|" -i.bak $(WATCHER_YAML) || true
	kubectl apply -f $(WATCHER_YAML)
	kubectl -n $(NAMESPACE) rollout status deploy/chain-watcher

.PHONY: apply-api
apply-api: ns ## deploy indexer-api
	sed -E -e "s|image: .*/indexer-api:.*|image: $(API_IMAGE)|" -i.bak $(API_YAML) || true
	kubectl apply -f $(API_YAML)
	kubectl -n $(NAMESPACE) rollout status deploy/indexer-api

.PHONY: apply-ingress
apply-ingress: ns ## deploy ingress
	kubectl apply -f $(INGRESS_YAML)
	kubectl -n $(NAMESPACE) get ingress

# Orkestrerad deploy — lägger in DB-schemat direkt efter Postgres
.PHONY: deploy
deploy: apply-postgres db-apply apply-watcher apply-api apply-ingress ## full deploy w/ schema

# ===== HPA =====
.PHONY: hpa-on
hpa-on:
	kubectl apply -f $(HPA_API_YAML)
	kubectl apply -f $(HPA_WAT_YAML)
	kubectl -n $(NAMESPACE) get hpa

.PHONY: hpa-off
hpa-off:
	kubectl -n $(NAMESPACE) delete hpa indexer-api-hpa --ignore-not-found
	kubectl -n $(NAMESPACE) delete hpa chain-watcher-hpa --ignore-not-found

# ===== Load for demo =====
.PHONY: load-api
load-api:
	kubectl -n $(NAMESPACE) run load --image=busybox --restart=Never -- sh -c 'while true; do wget -qO- http://indexer-api/health >/dev/null; done' || true

.PHONY: unload-api
unload-api:
	kubectl -n $(NAMESPACE) delete pod load --ignore-not-found

# ===== Status / Logs =====
.PHONY: status
status:
	@echo "== Deployments =="; kubectl -n $(NAMESPACE) get deploy
	@echo "== Services ==";    kubectl -n $(NAMESPACE) get svc
	@echo "== Ingress ==";     kubectl -n $(NAMESPACE) get ingress
	@echo "== HPA ==";         kubectl -n $(NAMESPACE) get hpa
	@echo "== Pods ==";        kubectl -n $(NAMESPACE) get pods -o wide

# ===== Reset =====
.PHONY: nuke
nuke:
	kubectl delete ns $(NAMESPACE) --ignore-not-found
	@echo "Namespace $(NAMESPACE) deleted. Re-deploy with: make deploy"
