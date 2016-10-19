#!/bin/sh
aws lambda add-permission --function-name arn:aws:lambda:us-east-1:737678946613:function:webhook:staging --source-arn arn:aws:execute-api:us-east-1:737678946613:9juc1mih86/*/GET/*/webhook --principal apigateway.amazonaws.com --statement-id fed7c77c-1727-4adf-baf5-c631bee94326 --action lambda:InvokeFunction
