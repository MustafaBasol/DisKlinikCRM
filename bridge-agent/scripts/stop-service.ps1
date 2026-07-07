#Requires -RunAsAdministrator
param([string]$NssmPath = "nssm.exe")
& $NssmPath stop NoraMediBridge
& $NssmPath status NoraMediBridge
