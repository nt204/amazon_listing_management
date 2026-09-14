import os
import boto3
from botocore.config import Config

R2_ACCOUNT_ID = "131dc461c96e378361b5f78dad32311a"
R2_BUCKET = "amazon-listing-production"
R2_ACCESS_KEY = "52739112f33077ed180d916efcfe322d"
R2_SECRET_KEY = "815b91b15dc6b32a89173b6cfd900f70d798eec46e22cd2f2d89f69f3de79bd5"

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name="auto",
    config=Config(s3={"addressing_style": "path"})
)

test_key = "ppc-reports/_test_probe.txt"
test_content = b"PPC Sync R2 Probe Test OK"

print("1. Testing PutObject to R2...")
s3.put_object(Bucket=R2_BUCKET, Key=test_key, Body=test_content)
print("   -> PutObject SUCCESS!")

print("2. Testing GetObject from R2...")
response = s3.get_object(Bucket=R2_BUCKET, Key=test_key)
content = response['Body'].read()
print(f"   -> GetObject SUCCESS: {content.decode('utf-8')}")

print("3. Testing DeleteObject from R2...")
s3.delete_object(Bucket=R2_BUCKET, Key=test_key)
print("   -> DeleteObject SUCCESS!")

print("\nALL CLOUDFLARE R2 PYTHON TESTS PASSED 100%!")
