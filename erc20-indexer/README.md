# ERC20 Indexer

A minimal Kubernetes-ready stack that ingests ERC20 token transfer events from Etherscan into Postgres and exposes them via a small web/API frontend.

## Components
- **chain-watcher** – Node.js worker that calls the Etherscan API, stores transfers in Postgres, and can run once or on an interval.
- **indexer-api** – Express application serving a JSON API and static single-page UI for searching transactions.
- **postgres** – Stateful backing store seeded with `db/schema.sql`.
- **Kubernetes manifests** – Deployments, services, ingress, HPAs, and helpers in `k8s/`.

## Prerequisites
- Docker (to build/push images).
- kubectl with a cluster that supports LoadBalancer/NodePort services (Docker Desktop, kind + MetalLB, AKS, etc.).
- Access to an Etherscan API key.
- An ingress controller; these instructions assume [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) (`kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml`).
- Optional but recommended: Docker Hub account to push tagged images (`DOCKER_USER` in `.env`).

## Quick Start
1. **Clone and configure**
   ```bash
   git clone <repo-url>
   cd erc20-indexer
   $EDITOR .env
   ```
   - Set `DOCKER_USER`, `ETHERSCAN_API_KEY`, and `WATCH_ADDRESS`.
   - Alternatively override values at runtime: `make deploy DOCKER_USER=… WATCH_ADDRESS=…`.
   - By default the watcher performs one ingestion pass (`RUN_ONCE=true`). Set `RUN_ONCE=false` if you want continuous polling every `POLL_DELAY_MS` (24h default).

2. **Initialize cluster resources**
   ```bash
   make init
   ```
   Creates the namespace, secrets, and installs metrics-server (needed for HPAs).

3. **(Optional) Build & push images**
   Pre-built images are already published to Docker Hub under `abth21/indexer-api:v2` and `abth21/chain-watcher:v5`. Only rebuild if you modify the code:
   ```bash
   make build-all
   make push-all
   ```
   Otherwise skip this step and `make deploy` will pull the published images.

4. **Deploy everything**
   ```bash
   make deploy
   ```
   Applies Postgres (with schema), chain-watcher, indexer-api, and ingress.

5. **Install ingress controller** (once per cluster)
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml
   kubectl -n ingress-nginx wait --for=condition=available deploy/ingress-nginx-controller
   ```
   If you are on Docker Desktop or another environment with self-signed kubelet certificates, patch metrics-server so HPAs receive metrics:
   ```bash
   kubectl -n kube-system patch deploy metrics-server \
     --type='json' \
     -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
   kubectl -n kube-system rollout status deploy/metrics-server
   ```

6. **Access the app**
   - The ingress hosts `indexer.localtest.me` which resolves to `127.0.0.1`. If your OS lacks wildcard support for `*.localtest.me`, add this line to `/etc/hosts` (or Windows hosts file):
     ```
     127.0.0.1 indexer.localtest.me
     ```
   - Browse to `http://indexer.localtest.me/` to use the UI, or call the API directly: `curl http://indexer.localtest.me/health`.

## Operations & Maintenance
- **Secrets**: After modifying `.env`, run `make secrets` to update Kubernetes secrets.
- **Rolling restarts**: `make apply-watcher`, `make apply-api`, or `kubectl rollout restart deploy/<name>`.
- **Watcher behaviour**:
  - `RUN_ONCE=true` (default) ingests the backlog once and then sleeps for `RUN_ONCE_SLEEP_MS` (24 h). Restart the deployment for another batch.
  - For continuous polling, set `RUN_ONCE=false` and keep `POLL_DELAY_MS` at the desired interval.
  - `REQUEST_DELAY_MS` throttles Etherscan requests to respect API rate limits.
- **Database access**: `kubectl -n erc20 exec deploy/postgres -- psql -U app -d appdb`.

## Horizontal Scaling
Requirement: “All microservices must be horizontally scalable independently.”
- HPAs are provided for each deployment (`k8s/indexer-api-hpa.yaml`, `k8s/chain-watcher-hpa.yaml`).
- Enable them after metrics-server is running:
  ```bash
  kubectl apply -f k8s/indexer-api-hpa.yaml
  kubectl apply -f k8s/chain-watcher-hpa.yaml
  kubectl -n erc20 get hpa
  ```
- You can adjust `minReplicas`, `maxReplicas`, and target CPU utilization independently per service.

### Load Testing the Watcher HPA
1. Apply the test load that burns CPU inside the namespace:
   ```bash
   kubectl apply -f k8s/load-chainwatcher.yaml
   ```
2. Observe the HPA:
   ```bash
   watch kubectl -n erc20 get hpa,deploy
   ```
   As CPU climbs above the target, the chain-watcher deployment scales up.
3. Remove the load generator:
   ```bash
   kubectl -n erc20 delete pod load-chainwatcher --ignore-not-found
   ```

### Load Testing the API HPA
Use any HTTP load generator (e.g., `hey`, `wrk`, or a simple loop) against `http://indexer.localtest.me/events/all?...` and monitor the `indexer-api-hpa` scaling behaviour. Example with `hey`:
```bash
hey -z 60s -c 20 "http://indexer.localtest.me/events/all?limit=50"
watch kubectl -n erc20 get hpa/indexer-api-hpa deploy/indexer-api
```

## Demo Script (Make-first)
Use this checklist when presenting the project or verifying a fresh clone:

1. `make init` – provisions namespace, secrets, and metrics-server prerequisites.
2. `make deploy` – deploys Postgres (schema included), chain-watcher, indexer-api, and ingress using the pre-built Docker Hub images.
3. Install ingress-nginx (if not already installed) and patch metrics-server as shown above.
4. `kubectl -n erc20 get pods,svc,ingress` – confirm workloads and endpoint `indexer.localtest.me`.
5. Browse to `http://indexer.localtest.me/` and search for the seeded watch address `0xd551234ae421e3bcba99a0da6d736074f22192ff`.
6. Load test & scaling demo:
   ```bash
   kubectl apply -f k8s/indexer-api-hpa.yaml
   kubectl -n erc20 run api-load --image=busybox --restart=Never -- \
     /bin/sh -c 'while true; do wget -q -O- http://indexer-api/events/all?limit=50 >/dev/null; done'
   kubectl -n erc20 top pods
   kubectl -n erc20 get hpa/indexer-api-hpa deploy/indexer-api
   ```
   Within ~1 minute the HPA scales `indexer-api` up (CPU should rise past the 60% target). When finished: `kubectl -n erc20 delete pod api-load` and optionally `kubectl delete hpa indexer-api-hpa -n erc20`.
7. Cleanup (if needed): `make nuke` and `kubectl delete ns ingress-nginx`.

## Troubleshooting
- **Ingress refuses connection**: Ensure the ingress controller is installed and running (`kubectl -n ingress-nginx get pods`).
- **Watcher idle**: If `RUN_ONCE=true`, restart it after updating secrets (`kubectl -n erc20 rollout restart deploy/chain-watcher`).
- **Database empty**: Check watcher logs (`kubectl -n erc20 logs deploy/chain-watcher`) for API key errors.
- **Local testing only**: If ingress is unavailable, port-forward temporarily with `kubectl -n erc20 port-forward svc/indexer-api 8080:80`.

## Cleanup
```bash
make nuke            # deletes the erc20 namespace
kubectl delete ns ingress-nginx  # optional, removes ingress controller
```

Feel free to tailor the `.env` and manifests for your registry, namespace, domains, or scaling targets before committing.
