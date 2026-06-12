variable "aws_region" {
  description = "AWS deployment region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix for tags and resources"
  type        = string
  default     = "sales-agent"
}

variable "environment" {
  description = "Application deployment environment"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "eks_cluster_name" {
  description = "Name of the EKS Cluster"
  type        = string
  default     = "sales-agent-eks"
}

variable "db_username" {
  description = "Username for the RDS PostgreSQL DB"
  type        = string
  default     = "dbadmin"
}

variable "db_password" {
  description = "Password for the RDS PostgreSQL DB"
  type        = string
  sensitive   = true
  default     = "SuperSecureDbPassword123!"
}
