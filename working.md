# VPC 

I have created VPC and this is the configuration 

```
aws ec2 create-vpc --no-amazon-provided-ipv6-cidr-block --instance-tenancy 'default' --cidr-block '10.0.0.0/16' --tag-specifications '{"ResourceType":"vpc","Tags":[{"Key":"Name","Value":"manarra-tech-project-1"}]}' 
```

- I have attached 
