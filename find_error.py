import os

def search_keyword(keyword, directory="."):
    print(f"Buscando '{keyword}' en el directorio: {os.path.abspath(directory)}...\n")
    found_count = 0
    
    valid_extensions = ('.js', '.py', '.ts', '.ejs', '.json')
    excluded_dirs = ('.git', 'node_modules', 'venv', '__pycache__', 'dist', 'build')

    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in excluded_dirs]
        
        for file in files:
            if file.endswith(valid_extensions):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        for line_num, line in enumerate(f, 1):
                            if keyword in line:
                                found_count += 1
                                print(f"Archivo: {file_path}")
                                print(f"   Linea {line_num}: {line.strip()}\n")
                except Exception as e:
                    print(f"No se pudo leer el archivo {file_path}: {e}")

    print(f"Busqueda finalizada. Se encontraron {found_count} coincidencias para '{keyword}'.")

if __name__ == "__main__":
    search_keyword("rawOutput")
