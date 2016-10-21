#!/bin/sh


for src in ${*};
do
    SIZE=`ffprobe -show_format -i ${src} 2>&1 | grep Stream | cut -d ' ' -f 10`
    echo "${src}:${SIZE}"
done
