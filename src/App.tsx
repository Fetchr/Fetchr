import { RouterProvider } from "@tanstack/react-router";

import { router } from "@/app/router";
import { LicenseGate } from "@/components/license-gate";

export function App() {
  return (
    <LicenseGate>
      <RouterProvider router={router} />
    </LicenseGate>
  );
}
