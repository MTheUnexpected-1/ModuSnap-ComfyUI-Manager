# ModuSnap ComfyUI Manager Web Migration

This folder contains manager web code migrated from:
- `apps/ModuSnap-ComfyUI/app/api/manager/*`
- `apps/ModuSnap-ComfyUI/app/api/_lib/managerEnvEngine.ts`
- `apps/ModuSnap-ComfyUI/components/NodesManagerModal.tsx`

Purpose:
- Move manager ownership into `apps/ModuSnap-ComfyUI-Manager`.
- Keep `apps/ModuSnap-ComfyUI` runtime stable during transition.

Next cutover step:
- Switch `apps/ModuSnap-ComfyUI` manager endpoints/components to import from this location,
  then remove duplicate manager code from `apps/ModuSnap-ComfyUI`.
