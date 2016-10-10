#!/bin/sh
#curl "http://localhost:8080/otp/routers/default/plan?fromPlace=1%3A124&toPlace=1%3A105&time=11%3A45am&date=09-30-2016&mode=TRANSIT%2CWALK&maxWalkDistance=804.672&arriveBy=true&wheelchair=false&locale=en"

curl "http://54.175.14.6:8080/otp/routers/default/plan?fromPlace=1%3A05&toPlace=1%3A124&mode=TRANSIT%2CWALK&maxWalkDistance=804.672&wheelchair=false&locale=en&numItineraries=5&showIntermediateStops=true&arriveBy=true&date=10-10-2016&time="

#curl "http://54.175.14.6:8080/otp/routers/default/index/trips/1%3A2767"

# Find stops
#curl "http://54.175.14.6:8080/otp/routers/default/index/stops?lat=40.353988319427&lon=-74.640870012458&radius=5000"
