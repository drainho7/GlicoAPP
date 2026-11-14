"""
Descoberta Bluetooth da balança de bioimpedância (somente escuta, nada é escrito na balança).

  python tools/scale_scan.py --address AA:BB:CC:DD:EE:FF --rounds 3

Em cada rodada o script espera você, escuta os anúncios da balança e pergunta o PESO QUE A BALANÇA MOSTROU.
Assim cada pacote fica pareado com o peso verdadeiro e dá para descobrir como o peso é codificado.
Tudo vai para data/scale_adv.jsonl (pasta ignorada pelo git).
Dica: feche o app da balança no celular (ou desligue o Bluetooth dele), senão ele "pega" a balança primeiro.
"""
import argparse
import asyncio
import json
import os
import time

from bleak import BleakClient, BleakScanner


def fmt_adv(device, adv):
    return {
        "address": device.address,
        "name": adv.local_name or device.name,
        "rssi": adv.rssi,
        "services": [str(u) for u in adv.service_uuids],
        "manufacturer": {f"0x{k:04x}": v.hex(" ") for k, v in adv.manufacturer_data.items()},
        "service_data": {str(k): v.hex(" ") for k, v in adv.service_data.items()},
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--address", help="endereço MAC da balança (em 'Informação da balança' no app dela)")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--connect", action="store_true", help="no fim, tenta ler os serviços GATT")
    args = ap.parse_args()

    os.makedirs("data", exist_ok=True)
    log = open(os.path.join("data", "scale_adv.jsonl"), "a", encoding="utf-8")
    t0 = time.time()
    state = {"round": 0, "last": None, "device": None, "count": 0}
    log.write(json.dumps({"session_start": time.strftime("%Y-%m-%d %H:%M:%S"), "address": args.address}) + "\n")

    def on_adv(device, adv):
        if args.address and device.address.upper() != args.address.upper():
            return
        rec = fmt_adv(device, adv)
        state["device"] = device
        state["count"] += 1
        rec["t"] = round(time.time() - t0, 2)
        rec["round"] = state["round"]
        log.write(json.dumps(rec, ensure_ascii=False) + "\n")  # grava todo pacote
        key = json.dumps({k: v for k, v in rec.items() if k not in ("rssi", "t", "round")}, sort_keys=True)
        if key != state["last"]:  # mostra só quando muda
            state["last"] = key
            print(f"   [{rec['t']:6.1f}s] fabricante={rec['manufacturer']}")
        log.flush()

    print("Escutando a balança. Feche o app dela no celular (ou desligue o Bluetooth dele).")
    async with BleakScanner(on_adv):
        for i in range(1, args.rounds + 1):
            state["round"] = 0
            await asyncio.to_thread(input, f"\nRODADA {i}/{args.rounds}: aperte Enter e DEPOIS suba na balança descalço... ")
            state["round"] = i
            state["last"] = None
            print("   (suba agora e espere o peso travar no visor da balança)")
            shown = await asyncio.to_thread(input, "   Peso que o VISOR da balança mostrou (ex.: 83,2): ")
            log.write(json.dumps({"round": i, "weight_shown": shown.strip().replace(",", "."), "t": round(time.time() - t0, 2)}) + "\n")
            log.flush()
            state["round"] = 0
            print("   Pode descer da balança. Aguarde ela apagar antes da próxima rodada.")
            await asyncio.sleep(2)

    print(f"\nPacotes recebidos: {state['count']}. Gravado em {os.path.join('data', 'scale_adv.jsonl')}")
    if state["count"] == 0:
        print("Nenhum anúncio da balança. Confira o endereço e se o app dela está fechado.")
        return

    if args.connect and state["device"]:
        print("\nTentando conectar para listar os serviços (suba na balança de novo se precisar)...")
        try:
            async with BleakClient(state["device"], timeout=25) as c:
                for s in c.services:
                    print(f"SERVIÇO {s.uuid}")
                    for ch in s.characteristics:
                        print(f"   {ch.uuid}  [{', '.join(ch.properties)}]")
        except Exception as e:
            print("Não foi possível conectar:", e)


asyncio.run(main())
