"use client";

import { Phone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { connectWhatsAppEmbedded } from "@/app/app/channel-actions";
import { useDashboard } from "./provider";
import { Button } from "./ui";

type SignupConfig = { appId: string; configId: string; version: string };

type FacebookSdk = {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
    options: Record<string, unknown>,
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<FacebookSdk> | null = null;

// Loads Meta's JavaScript SDK once, only when the owner clicks connect.
function loadSdk(config: SignupConfig): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const ready = () => {
      if (!window.FB) return reject(new Error("Meta’s login didn’t load."));
      window.FB.init({ appId: config.appId, autoLogAppEvents: true, xfbml: false, version: config.version });
      resolve(window.FB);
    };
    if (window.FB) return ready();
    window.fbAsyncInit = ready;
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Meta’s login couldn’t load. Check that nothing blocks facebook.com."));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

// Meta's Embedded Signup: the owner logs in, picks or creates a WhatsApp
// business account and number, and verifies it — without leaving HelloCrew.
export function WhatsAppSignupButton({
  config,
  label,
  variant = "primary",
  onConnected,
}: {
  config: SignupConfig;
  label: string;
  variant?: "primary" | "secondary";
  onConnected: () => void;
}) {
  const { toast } = useDashboard();
  const [busy, setBusy] = useState(false);
  const session = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

  // Meta posts the chosen number and account from its popup.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(event.origin)) return;
      let data: { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string } };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event?.startsWith("FINISH"))
        session.current = { phoneNumberId: data.data?.phone_number_id, wabaId: data.data?.waba_id };
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const finish = useCallback(
    async (code: string) => {
      // The popup's message can arrive just after the login callback.
      for (let i = 0; i < 20 && !(session.current.phoneNumberId && session.current.wabaId); i++)
        await new Promise((r) => setTimeout(r, 150));
      const { phoneNumberId, wabaId } = session.current;
      if (!phoneNumberId || !wabaId) {
        setBusy(false);
        return toast("WhatsApp signup finished without a phone number. Try again and add a number.", "error");
      }
      const result = await connectWhatsAppEmbedded({ code, phoneNumberId, wabaId }).catch(() => null);
      setBusy(false);
      if (!result?.ok) return toast(result?.error ?? "Couldn’t connect WhatsApp.", "error");
      toast(result.warning ?? "WhatsApp connected", result.warning ? "info" : "success");
      onConnected();
    },
    [onConnected, toast],
  );

  return (
    <Button
      size="sm"
      variant={variant}
      icon={Phone}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        session.current = {};
        let fb: FacebookSdk;
        try {
          fb = await loadSdk(config);
        } catch (error) {
          setBusy(false);
          return toast(error instanceof Error ? error.message : "Meta’s login couldn’t load.", "error");
        }
        fb.login(
          (response) => {
            const code = response.authResponse?.code;
            if (!code) {
              setBusy(false);
              return toast("WhatsApp signup was cancelled.", "info");
            }
            void finish(code);
          },
          {
            config_id: config.configId,
            response_type: "code",
            override_default_response_type: true,
            extras: { setup: {} },
          },
        );
      }}
    >
      {busy ? "Connecting…" : label}
    </Button>
  );
}
