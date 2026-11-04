"""Read-only host telemetry. A missing measurement is null, never zero."""
import math
from pathlib import Path
import subprocess
import threading
import time


def gpu_reading():
    return subprocess.run(['nvidia-smi',
        '--query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw',
        '--format=csv,noheader,nounits'], check=True, capture_output=True,
        text=True, timeout=2).stdout


def number(text, maximum=None):
    try:
        value = float(text.strip())
        return value if math.isfinite(value) and value >= 0 and (maximum is None or value <= maximum) else None
    except (ValueError, TypeError):
        return None


class SystemMonitor:
    def __init__(self, read=None, gpu=None, clock=None):
        self.read = read or (lambda path: Path(path).read_text())
        self.gpu = gpu or gpu_reading
        self.clock = clock or time.time
        self.previous = None
        self.last = {}
        self.lock = threading.Lock()

    def sample(self):
        with self.lock:
            now = self.clock()
            cpu = used = total = None
            cores = None
            try:
                lines = self.read('/proc/stat').splitlines()
                # Aggregate cpu includes every core; guest counters are already in user/nice.
                ticks = [int(v) for v in lines[0].split()[1:9]]
                if not lines[0].startswith('cpu ') or len(ticks) != 8 or min(ticks) < 0:
                    raise ValueError('bad counters')
                current = (sum(ticks), ticks[3] + ticks[4])
                cores = sum(line.split()[0][3:].isdigit() for line in lines if line.startswith('cpu'))
                if self.previous:
                    dt, idle = current[0] - self.previous[0], current[1] - self.previous[1]
                    if dt > 0 and 0 <= idle <= dt:
                        cpu = round(100 * (dt - idle) / dt, 1)
                self.previous = current
            except (OSError, ValueError, IndexError):
                self.previous = None
            try:
                mem = dict((line.split(':')[0], int(line.split()[1]))
                           for line in self.read('/proc/meminfo').splitlines())
                total = mem['MemTotal'] / 1048576
                used = (mem['MemTotal'] - mem['MemAvailable']) / 1048576
                if not 0 <= used <= total or total <= 0:
                    used = total = None
            except (OSError, ValueError, KeyError, IndexError):
                pass
            fields = []
            try:
                fields = self.gpu().strip().splitlines()[0].split(',')
            except (OSError, subprocess.SubprocessError, IndexError):
                pass
            values = [number(v) for v in fields] if len(fields) == 4 else [None] * 4
            utilization, memory, temperature, power = values
            if utilization is not None and utilization > 100:
                utilization = None
            measurements = {'cpu_percent': cpu, 'gpu_percent': utilization,
                'memory_used_gb': memory / 1024 if memory is not None else used,
                'gpu_temperature_c': temperature, 'gpu_power_w': power}
            result = {'sampled_at': now, 'cpu_cores': cores,
                'memory_total_gb': total, 'memory_source': 'gpu' if memory is not None else 'unified'}
            for key, value in measurements.items():
                if value is not None:
                    self.last[key] = now
                result[key] = {'value': value, 'last_read_at': self.last.get(key)}
            return result


monitor = SystemMonitor()
