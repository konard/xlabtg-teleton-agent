# teleton-agent Helm chart

A minimal Helm chart for deploying [Teleton Agent](https://github.com/xlabtg/teleton-agent) on Kubernetes.

It renders a `Deployment` (single replica, `Recreate` strategy), a `Service`, a
`PersistentVolumeClaim` for the agent's data directory (`/data`), and an optional
`Secret` for credentials.

## Install

```bash
# From a local checkout of the repository:
helm install teleton ./helm/teleton-agent --namespace teleton --create-namespace
```

## First-run setup

The first launch requires interactive Telegram authentication. Run the setup
wizard inside the running pod, then restart the deployment:

```bash
kubectl exec -it -n teleton deploy/teleton-teleton-agent -- node dist/cli/index.js setup
kubectl rollout restart -n teleton deploy/teleton-teleton-agent
```

Alternatively, pass credentials non-interactively via `secrets` / `existingSecret`.

## Configuration

| Key | Description | Default |
|-----|-------------|---------|
| `image.repository` | Container image repository | `ghcr.io/xlabtg/teleton-agent` |
| `image.tag` | Image tag (defaults to chart `appVersion`) | `""` |
| `replicaCount` | Number of replicas (keep at 1) | `1` |
| `env` | Plain environment variables | see `values.yaml` |
| `extraEnv` | Additional env vars (list form) | `[]` |
| `secrets` | Sensitive env vars rendered into a Secret | `{}` |
| `existingSecret` | Use an existing Secret instead of `secrets` | `""` |
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service / WebUI port | `7777` |
| `persistence.enabled` | Create a PVC for `/data` | `true` |
| `persistence.existingClaim` | Use an existing PVC | `""` |
| `persistence.storageClass` | StorageClass for the PVC | `""` |
| `persistence.size` | PVC size | `1Gi` |
| `probes.enabled` | Liveness/readiness probes on `/health` | `true` |
| `resources` | Pod resource requests/limits | `{}` |

See [`values.yaml`](values.yaml) for the full list.

## Uninstall

```bash
helm uninstall teleton --namespace teleton
# The PVC is retained by default; delete it manually if you want to wipe data:
# kubectl delete pvc -n teleton teleton-teleton-agent-data
```
