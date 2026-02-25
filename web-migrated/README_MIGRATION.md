# ModuSnap ComfyUI Manager Web Migration

This folder contains manager web code migrated from:
- `apps/ModuSnap-ComfyUI-Frontend/app/api/manager/*`
- `apps/ModuSnap-ComfyUI-Frontend/app/api/_lib/managerEnvEngine.ts`
- `apps/ModuSnap-ComfyUI-Frontend/components/NodesManagerModal.tsx`

Purpose:
- Move manager ownership into `apps/ModuSnap-ComfyUI-Manager`.
- Keep `apps/ModuSnap-ComfyUI-Frontend` runtime stable during transition.

Next cutover step:
- Switch `apps/ModuSnap-ComfyUI-Frontend` manager endpoints/components to import from this location,
  then remove duplicate manager code from `apps/ModuSnap-ComfyUI-Frontend`.
