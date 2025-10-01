# Benefits, Challenges, and Security

## Benefits
- **Clear split**: chain-watcher ingests; indexer-api serves; Postgres stores.  
- **Independent scaling**: each service has its own HPA.  
- **Persistence**: Postgres uses a PVC, so data survives restarts.  

## Challenges
- **Single DB**: one point of failure and possible bottleneck.  
- **External API limits**: Back-pressure & rate limits (Etherscan): implement retries with exponential backoff; cache last processed block; consider batching.
- **Visibility**: limited metrics/logging out of the box.  

## Security & Mitigations (What’s Done / Next)

**Done**  
- **Secrets**: DB password & API keys stored as Kubernetes Secrets and injected via env.  
- DB internal (ClusterIP)  
- Declarative deploys  

**Next**  
- StatefulSet/managed DB + backups   
- Set requests/limits, probes, and HPA tuning  
- Run as non-root, no privilege escalation  
- Add TLS and basic app metrics/alerts  