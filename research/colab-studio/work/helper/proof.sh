#!/bin/bash
# The helper job once, end to end, from this server: start, run the cell, one line in, audio out, stop.
export PATH=$HOME/.local/bin:$PATH
S=helper1; T0=$(date +%s); t() { echo "$(( $(date +%s) - T0 )) s  $1"; }
colab new -s $S --gpu T4 < /dev/null | tail -n 1; t "machine started"
colab upload -s $S ~/studio_helper.py /content/studio_helper.py < /dev/null | tail -n 1
echo "!nohup python /content/studio_helper.py > /content/run.log 2>&1 &" | colab exec -s $S --timeout 120; t "cell started"
for i in $(seq 1 60); do
  echo "!test -f /content/studio/status/ready.json && echo READY" | colab exec -s $S --timeout 60 2>/dev/null | grep -q READY && break; sleep 5
done; t "cell ready"
colab upload -s $S ~/helper-1.json /content/studio/jobs/helper-1.json < /dev/null | tail -n 1; t "request sent"
for i in $(seq 1 40); do
  echo "!test -f /content/studio/audio/helper-1.json && echo DONE" | colab exec -s $S --timeout 60 2>/dev/null | grep -q DONE && break; sleep 2
done; t "audio ready"
colab download -s $S /content/studio/audio/helper-1.wav ~/helper-1.wav < /dev/null | tail -n 1
colab download -s $S /content/studio/audio/helper-1.json ~/helper-1.result.json < /dev/null | tail -n 1; t "audio fetched"
echo "!cat /content/studio/status/ready.json" | colab exec -s $S --timeout 60 2>/dev/null | tail -n 1
colab stop -s $S < /dev/null | tail -n 1; t "machine stopped"
colab sessions < /dev/null; colab usage < /dev/null
cat ~/helper-1.result.json; echo; ls -la ~/helper-1.wav; free -m | sed -n 2p
