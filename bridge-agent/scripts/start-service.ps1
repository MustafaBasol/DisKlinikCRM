#Requires -RunAsAdministrator
param([string]$NssmPath = "nssm.exe")
& $NssmPath start NoraMediBridge
& $NssmPath status NoraMediBridge
