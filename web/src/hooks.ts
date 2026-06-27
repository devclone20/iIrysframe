import { useEffect, useState } from "react";
import { useWallet } from "./wallet";
import { makeUploader } from "./irys";
import { toast, errMsg } from "./ui";

/** Build (and rebuild) the Irys uploader from the connected wallet's provider. */
export function useIrys(): any {
  const w = useWallet();
  const [irys, setIrys] = useState<any>(null);

  useEffect(() => {
    let live = true;
    if (w.connected) {
      (async () => {
        try {
          const provider = await w.getProvider();
          if (provider && live) {
            const uploader = await makeUploader(provider);
            if (live) setIrys(uploader);
          }
        } catch (e) {
          if (live) {
            setIrys(null);
            toast(`Irys init failed: ${errMsg(e)}`, "err");
          }
        }
      })();
    } else {
      setIrys(null);
    }
    return () => {
      live = false;
    };
  }, [w.connected, w.address]);

  return irys;
}
