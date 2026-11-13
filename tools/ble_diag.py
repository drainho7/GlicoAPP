"""
Diagnóstico BLE para o CareTech Precision 984 no PC (Windows/bleak).

  python tools/ble_diag.py                 -> escaneia 10 s e deixa escolher o dispositivo
  python tools/ble_diag.py --pair          -> tenta parear (o Windows mostra o PIN, se exigido)
  python tools/ble_diag.py --import        -> se 1808+2A18+2A52 existirem, importa o histórico (somente leitura)

Nunca escreve em características desconhecidas. Só escreve 01 01 no RACP (0x2A52).
"""
import argparse
import asyncio
import struct
import sys

from bleak import BleakClient, BleakScanner

BASE = "0000{:04x}-0000-1000-8000-00805f9b34fb"
GLUCOSE_SVC, MEAS, CTX, FEAT, RACP = (BASE.format(x) for x in (0x1808, 0x2A18, 0x2A34, 0x2A51, 0x2A52))
NAMES = {0x1800: "Generic Access", 0x1801: "Generic Attribute", 0x180A: "Device Information",
         0x1808: "Glucose", 0x2A18: "Glucose Measurement", 0x2A34: "Glucose Context",
         0x2A51: "Glucose Feature", 0x2A52: "RACP", 0x2A24: "Model", 0x2A25: "Serial", 0x2A29: "Manufacturer"}


def short(u: str) -> str:
    u = u.lower()
    if u.endswith("-0000-1000-8000-00805f9b34fb") and u.startswith("0000"):
        return u[4:8].upper()
    return u


def label(u: str) -> str:
    s = short(u)
    try:
        return f"{s} ({NAMES[int(s, 16)]})" if len(s) == 4 and int(s, 16) in NAMES else s
    except ValueError:
        return s


def sfloat(raw: int):
    if raw in (0x07FF, 0x0800, 0x07FE, 0x0802, 0x0801):
        return None
    m, e = raw & 0x0FFF, raw >> 12
    m -= 0x1000 if m >= 0x800 else 0
    e -= 0x10 if e >= 0x8 else 0
    return m * 10 ** e


def parse_meas(d: bytes):
    flags = d[0]
    seq = struct.unpack_from("<H", d, 1)[0]
    y, mo, da, h, mi, s = struct.unpack_from("<HBBBBB", d, 3)
    p = 10
    off = 0
    if flags & 1:
        off = struct.unpack_from("<h", d, p)[0]; p += 2
    mgdl = None
    if flags & 2:
        v = sfloat(struct.unpack_from("<H", d, p)[0]); p += 3
        if v is not None:
            mgdl = round(v * (18015.6 if flags & 4 else 100000), 2)
    return seq, f"{y:04d}-{mo:02d}-{da:02d} {h:02d}:{mi:02d}:{s:02d}", off, mgdl


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", action="store_true")
    ap.add_argument("--import", dest="do_import", action="store_true")
    ap.add_argument("--address")
    args = ap.parse_args()

    addr = args.address
    if addr:
        print("Procurando o medidor (10 s)... ative o Bluetooth dele (aperte o botão se já desligou).")
        found = await BleakScanner.discover(timeout=10, return_adv=True)
        match = [d for d, adv in found.values()
                 if d.address.upper() == addr.upper() or (adv.local_name or d.name or "").startswith("meter+")]
        if match:
            addr = match[0]
            print("Encontrado:", match[0].name, match[0].address)
        else:
            sys.exit("Medidor não encontrado: ative o Bluetooth dele e rode de novo.")
    else:
        print("Escaneando 10 s (sem filtro)... deixe o Bluetooth do medidor ativo.")
        found = await BleakScanner.discover(timeout=10, return_adv=True)
        items = sorted(found.values(), key=lambda x: x[1].rssi, reverse=True)
        for i, (d, adv) in enumerate(items):
            print(f"[{i}] {adv.local_name or d.name or '(sem nome)'}  {d.address}  RSSI {adv.rssi}  svc={[short(u) for u in adv.service_uuids]}")
        if not items:
            sys.exit("Nada encontrado. O Bluetooth do PC está ligado?")
        addr = items[int(input("Número do medidor: "))][0].address

    async with BleakClient(addr, timeout=20) as c:
        print(f"\nConectado: {c.is_connected}")
        if args.pair:
            print("Pareando (o Windows pode pedir PIN)...")
            try:
                print("pair ->", await c.pair())
            except Exception as e:
                print("pair falhou:", e)

        print("\n== Serviços GATT ==")
        for s in c.services:
            print(f"SERVIÇO {label(s.uuid)}")
            for ch in s.characteristics:
                print(f"   {label(ch.uuid)}  [{', '.join(ch.properties)}]")

        # O 2A52 pode aparecer duplicado (também num serviço proprietário): usar só o do 1808, por objeto/handle.
        svc = c.services.get_service(GLUCOSE_SVC)
        meas_ch = svc.get_characteristic(MEAS) if svc else None
        racp_ch = svc.get_characteristic(RACP) if svc else None
        ok = meas_ch is not None and racp_ch is not None
        print("\nGlucose Service padrão:", "CONFIRMADO" if ok else "NÃO encontrado (serviços acima são tudo que o medidor expõe)")
        if not (ok and args.do_import):
            return

        readings, done = {}, asyncio.Event()

        def on_meas(_, d: bytearray):
            print("2A18 <-", d.hex(" "))
            try:
                r = parse_meas(bytes(d))
                readings[(r[0], r[1])] = r
            except Exception as e:
                print("  ignorado:", e)

        def on_racp(_, d: bytearray):
            print("2A52 <-", d.hex(" "))
            if d[0] == 0x06:
                print("  RACP resultado:", {1: "sucesso", 6: "sem registros"}.get(d[3], f"erro {d[3]}"))
                done.set()

        try:
            await c.start_notify(meas_ch, on_meas)
            await c.start_notify(racp_ch, on_racp)
        except Exception as e:
            if "Authentication" in str(e) or "Encryption" in str(e) or "Authorization" in str(e):
                sys.exit("\nO medidor exige PAREAMENTO. Pareie pelo Windows (Configurações > Bluetooth) "
                         "ou rode com --pair, e tente de novo.")
            raise
        await asyncio.sleep(0.6)
        print("2A52 (serviço 1808) -> 01 01")
        await c.write_gatt_char(racp_ch, b"\x01\x01", response=True)
        try:
            await asyncio.wait_for(done.wait(), 60)
        except asyncio.TimeoutError:
            print("TIMEOUT sem indicação final")
        await asyncio.sleep(0.5)
        print(f"\n== {len(readings)} leitura(s) ==")
        import json, os
        from datetime import datetime, timedelta
        rows = []
        for seq, t, off, mg in sorted(readings.values(), key=lambda r: r[1]):
            adj = (datetime.strptime(t, "%Y-%m-%d %H:%M:%S") + timedelta(minutes=off)).strftime("%Y-%m-%d %H:%M:%S")
            print(f"#{seq:<5} base {t}  offset {off:>4} min  => com offset {adj}  {mg if mg is not None else 'sem valor'} mg/dL")
            if mg is not None:
                rows.append({"key": f"{addr.address if hasattr(addr, 'address') else addr}|{seq}|{t}", "sequence": seq,
                             "baseTime": t, "offsetMinutes": off, "adjustedTime": adj, "mgdl": mg})
        os.makedirs("data", exist_ok=True)
        path = os.path.join("data", "readings.json")
        old = {r["key"]: r for r in json.load(open(path, encoding="utf-8"))} if os.path.exists(path) else {}
        new = sum(1 for r in rows if r["key"] not in old)
        old.update({r["key"]: r for r in rows})
        json.dump(sorted(old.values(), key=lambda r: r["adjustedTime"]), open(path, "w", encoding="utf-8"), indent=1)
        print(f"\nSalvo em {path}: {new} nova(s), {len(old)} no total (sem duplicar).")


asyncio.run(main())
